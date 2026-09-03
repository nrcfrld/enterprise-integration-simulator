package auth

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

var (
	// ErrIdentityNotFound allows a repository to hide persistence-specific
	// not-found errors from the application service.
	ErrIdentityNotFound = errors.New("identity not found")
	// ErrInvalidCredentials is safe to return to callers during login.
	ErrInvalidCredentials = errors.New("invalid credentials")
	// ErrInvalidSession is safe to return when a session cannot be trusted.
	ErrInvalidSession = errors.New("invalid session")
	// ErrInvalidRegistration identifies invalid self-registration data.
	ErrInvalidRegistration = errors.New("invalid registration")
	// ErrEmailAlreadyRegistered avoids leaking database errors to HTTP callers.
	ErrEmailAlreadyRegistered = errors.New("email already registered")
)

// Identity is the persisted user state required by authentication decisions.
// PasswordHash is read only by login and is never returned by HTTP handlers.
type Identity struct {
	ID             string
	Email          string
	Role           string
	SessionVersion int
	PasswordHash   string
}

// IdentityRepository isolates authentication from its persistence mechanism.
// Implementations must return ErrIdentityNotFound when no identity exists.
type IdentityRepository interface {
	FindByEmail(ctx context.Context, email string) (Identity, error)
	FindByID(ctx context.Context, id string) (Identity, error)
}

// IdentityRegistrar persists a new self-service operator account.
type IdentityRegistrar interface {
	Create(ctx context.Context, identity Identity) error
}

// Option configures an optional authentication use case.
type Option func(*Service)

// WithRegistration enables self-service operator registration.
func WithRegistration(registrar IdentityRegistrar, newID func(prefix string) string) Option {
	return func(service *Service) {
		service.registrar = registrar
		service.newID = newID
	}
}

// Service owns authentication use cases and session validity rules.
type Service struct {
	identities    IdentityRepository
	registrar     IdentityRegistrar
	newID         func(prefix string) string
	sessionSecret []byte
}

// NewService constructs the authentication application service.
func NewService(identities IdentityRepository, sessionSecret []byte, options ...Option) *Service {
	service := &Service{identities: identities, sessionSecret: sessionSecret}
	for _, option := range options {
		option(service)
	}
	return service
}

// Register creates an OPERATOR account and issues its first control-plane
// session. Administrator accounts can only be created by an existing admin.
func (s *Service) Register(ctx context.Context, email, password string) (Claims, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	parsedEmail, err := mail.ParseAddress(email)
	if err != nil || parsedEmail.Address != email || len(password) < 8 {
		return Claims{}, "", ErrInvalidRegistration
	}
	if s.registrar == nil || s.newID == nil {
		return Claims{}, "", fmt.Errorf("registration is not configured")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return Claims{}, "", fmt.Errorf("hash registration password: %w", err)
	}
	identity := Identity{ID: s.newID("usr"), Email: email, Role: "OPERATOR", SessionVersion: 1, PasswordHash: string(hash)}
	if err := s.registrar.Create(ctx, identity); err != nil {
		return Claims{}, "", fmt.Errorf("create registration identity: %w", err)
	}
	claims := Claims{ID: identity.ID, Email: identity.Email, Role: identity.Role, SessionVersion: identity.SessionVersion}
	token, err := Issue(s.sessionSecret, claims)
	if err != nil {
		return Claims{}, "", fmt.Errorf("issue registration session: %w", err)
	}
	return claims, token, nil
}

// Login validates credentials and returns a signed session token plus claims
// suitable for an HTTP response. It deliberately returns one public error for
// unknown users and incorrect passwords.
func (s *Service) Login(ctx context.Context, email, password string) (Claims, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || password == "" {
		return Claims{}, "", ErrInvalidCredentials
	}
	identity, err := s.identities.FindByEmail(ctx, email)
	if errors.Is(err, ErrIdentityNotFound) {
		return Claims{}, "", ErrInvalidCredentials
	}
	if err != nil {
		return Claims{}, "", fmt.Errorf("find login identity: %w", err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(identity.PasswordHash), []byte(password)); err != nil {
		return Claims{}, "", ErrInvalidCredentials
	}
	claims := Claims{ID: identity.ID, Email: identity.Email, Role: identity.Role, SessionVersion: identity.SessionVersion}
	token, err := Issue(s.sessionSecret, claims)
	if err != nil {
		return Claims{}, "", fmt.Errorf("issue session token: %w", err)
	}
	return claims, token, nil
}

// AuthenticateSession verifies both the signed token and its persisted session
// version, so password/session revocation takes effect immediately.
func (s *Service) AuthenticateSession(ctx context.Context, token string) (Claims, error) {
	claims, err := Parse(s.sessionSecret, token)
	if err != nil {
		return Claims{}, ErrInvalidSession
	}
	identity, err := s.identities.FindByID(ctx, claims.ID)
	if errors.Is(err, ErrIdentityNotFound) {
		return Claims{}, ErrInvalidSession
	}
	if err != nil {
		return Claims{}, fmt.Errorf("find session identity: %w", err)
	}
	if identity.Email != claims.Email || identity.Role != claims.Role || identity.SessionVersion != claims.SessionVersion {
		return Claims{}, ErrInvalidSession
	}
	return claims, nil
}
