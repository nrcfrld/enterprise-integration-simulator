package auth

import (
	"context"
	"errors"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

type fakeIdentityRepository struct {
	byEmail map[string]Identity
	byID    map[string]Identity
	err     error
}

type fakeIdentityRegistrar struct {
	identity Identity
	err      error
}

func (r *fakeIdentityRegistrar) Create(_ context.Context, identity Identity) error {
	r.identity = identity
	return r.err
}

func (r fakeIdentityRepository) FindByEmail(_ context.Context, email string) (Identity, error) {
	if r.err != nil {
		return Identity{}, r.err
	}
	identity, ok := r.byEmail[email]
	if !ok {
		return Identity{}, ErrIdentityNotFound
	}
	return identity, nil
}

func (r fakeIdentityRepository) FindByID(_ context.Context, id string) (Identity, error) {
	if r.err != nil {
		return Identity{}, r.err
	}
	identity, ok := r.byID[id]
	if !ok {
		return Identity{}, ErrIdentityNotFound
	}
	return identity, nil
}

func TestServiceLogin(t *testing.T) {
	t.Parallel()
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("generate password hash: %v", err)
	}
	identity := Identity{ID: "usr_1", Email: "admin@example.test", Role: "ADMIN", SessionVersion: 2, PasswordHash: string(hash)}
	service := NewService(fakeIdentityRepository{byEmail: map[string]Identity{identity.Email: identity}}, []byte("test-session-secret"))

	tests := []struct {
		name     string
		email    string
		password string
		wantErr  error
	}{
		{name: "normalizes email", email: " ADMIN@EXAMPLE.TEST ", password: "correct-password"},
		{name: "rejects unknown identity", email: "missing@example.test", password: "correct-password", wantErr: ErrInvalidCredentials},
		{name: "rejects incorrect password", email: identity.Email, password: "wrong-password", wantErr: ErrInvalidCredentials},
		{name: "rejects empty password", email: identity.Email, wantErr: ErrInvalidCredentials},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			claims, token, loginErr := service.Login(context.Background(), test.email, test.password)
			if !errors.Is(loginErr, test.wantErr) {
				t.Fatalf("Login() error = %v, want %v", loginErr, test.wantErr)
			}
			if test.wantErr != nil {
				return
			}
			if claims.ID != identity.ID || token == "" {
				t.Fatalf("Login() = (%#v, %q), want identity and token", claims, token)
			}
		})
	}
}

func TestServiceRegister(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		email        string
		password     string
		registrarErr error
		wantErr      error
	}{
		{name: "creates normalized operator session", email: " NEW@EXAMPLE.TEST ", password: "register-password"},
		{name: "rejects invalid email", email: "not-an-email", password: "register-password", wantErr: ErrInvalidRegistration},
		{name: "rejects short password", email: "new@example.test", password: "short", wantErr: ErrInvalidRegistration},
		{name: "preserves duplicate email", email: "new@example.test", password: "register-password", registrarErr: ErrEmailAlreadyRegistered, wantErr: ErrEmailAlreadyRegistered},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			registrar := &fakeIdentityRegistrar{err: test.registrarErr}
			service := NewService(fakeIdentityRepository{}, []byte("test-session-secret"), WithRegistration(registrar, func(string) string { return "usr_registered" }))
			claims, token, err := service.Register(context.Background(), test.email, test.password)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Register() error = %v, want %v", err, test.wantErr)
			}
			if test.wantErr != nil {
				return
			}
			if claims.ID != "usr_registered" || claims.Email != "new@example.test" || claims.Role != "OPERATOR" || claims.SessionVersion != 1 || token == "" {
				t.Fatalf("Register() = (%#v, %q)", claims, token)
			}
			if registrar.identity.PasswordHash == "" || registrar.identity.PasswordHash == test.password {
				t.Fatalf("Register() persisted insecure identity: %#v", registrar.identity)
			}
		})
	}
}

func TestServiceAuthenticateSession(t *testing.T) {
	t.Parallel()
	secret := []byte("test-session-secret")
	identity := Identity{ID: "usr_1", Email: "admin@example.test", Role: "ADMIN", SessionVersion: 2}
	token, err := Issue(secret, Claims{ID: identity.ID, Email: identity.Email, Role: identity.Role, SessionVersion: identity.SessionVersion})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	tests := []struct {
		name    string
		repo    fakeIdentityRepository
		token   string
		wantErr error
	}{
		{name: "valid persisted session", repo: fakeIdentityRepository{byID: map[string]Identity{identity.ID: identity}}, token: token},
		{name: "revoked session version", repo: fakeIdentityRepository{byID: map[string]Identity{identity.ID: {ID: identity.ID, Email: identity.Email, Role: identity.Role, SessionVersion: 3}}}, token: token, wantErr: ErrInvalidSession},
		{name: "missing identity", repo: fakeIdentityRepository{}, token: token, wantErr: ErrInvalidSession},
		{name: "repository failure is preserved", repo: fakeIdentityRepository{err: errors.New("database unavailable")}, token: token, wantErr: nil},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			service := NewService(test.repo, secret)
			claims, authErr := service.AuthenticateSession(context.Background(), test.token)
			if test.name == "repository failure is preserved" {
				if authErr == nil || errors.Is(authErr, ErrInvalidSession) {
					t.Fatalf("AuthenticateSession() error = %v, want wrapped repository error", authErr)
				}
				return
			}
			if !errors.Is(authErr, test.wantErr) {
				t.Fatalf("AuthenticateSession() error = %v, want %v", authErr, test.wantErr)
			}
			if test.wantErr == nil && claims.ID != identity.ID {
				t.Fatalf("AuthenticateSession() claims = %#v, want %s", claims, identity.ID)
			}
		})
	}
}
