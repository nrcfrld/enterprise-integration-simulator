package server

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/scenarios"
)

func (s *Server) getScenario(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	s.scenarioResponse(c, shop)
}
func (s *Server) putScenario(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	var v scenarios.Config
	if err := c.ShouldBindJSON(&v); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "invalid scenario configuration"))
		return
	}
	if err := v.Validate(); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "invalid scenario values"))
		return
	}
	_, err := s.db.Exec(c, `INSERT INTO shop_scenarios(shop_id,api_slow_ms,api_slow_probability,api_random_500_probability,api_timeout_probability,force_rate_limit,webhook_duplicate,webhook_delay_seconds,webhook_out_of_order,webhook_force_failure) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(shop_id) DO UPDATE SET api_slow_ms=EXCLUDED.api_slow_ms,api_slow_probability=EXCLUDED.api_slow_probability,api_random_500_probability=EXCLUDED.api_random_500_probability,api_timeout_probability=EXCLUDED.api_timeout_probability,force_rate_limit=EXCLUDED.force_rate_limit,webhook_duplicate=EXCLUDED.webhook_duplicate,webhook_delay_seconds=EXCLUDED.webhook_delay_seconds,webhook_out_of_order=EXCLUDED.webhook_out_of_order,webhook_force_failure=EXCLUDED.webhook_force_failure,updated_at=now()`, shop, v.APISlowMS, v.APISlowProbability, v.APIRandom500Probability, v.APITimeoutProbability, v.ForceRateLimit, v.WebhookDuplicate, v.WebhookDelaySeconds, v.WebhookOutOfOrder, v.WebhookForceFailure)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not save scenario"))
		return
	}
	s.scenarioResponse(c, shop)
}

func (s *Server) scenarioResponse(c *gin.Context, shop string) {
	v, err := s.loadScenario(c, shop)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not load scenario"))
		return
	}
	c.JSON(200, v)
}

func (s *Server) maintenance(c *gin.Context) {
	var v struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&v); err != nil {
		c.JSON(400, errorBody("INVALID_REQUEST", "enabled is required"))
		return
	}
	raw, _ := json.Marshal(v.Enabled)
	_, err := s.db.Exec(c, `INSERT INTO system_settings(key,value) VALUES('maintenance',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, raw)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not update maintenance"))
		return
	}
	c.JSON(200, gin.H{"enabled": v.Enabled})
}

func (s *Server) getMaintenance(c *gin.Context) {
	var raw []byte
	err := s.db.QueryRow(c, `SELECT value FROM system_settings WHERE key='maintenance'`).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(200, gin.H{"enabled": false})
		return
	}
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not load maintenance mode"))
		return
	}
	var enabled bool
	if err := json.Unmarshal(raw, &enabled); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "maintenance setting is malformed"))
		return
	}
	c.JSON(200, gin.H{"enabled": enabled})
}

func (s *Server) listUsers(c *gin.Context) {
	rows, err := s.db.Query(c, `SELECT id,email,role,created_at FROM users ORDER BY created_at`)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not list users"))
		return
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, email, role string
		var created time.Time
		if err := rows.Scan(&id, &email, &role, &created); err != nil {
			c.JSON(500, errorBody("DATABASE_ERROR", "could not read user"))
			return
		}
		data = append(data, gin.H{"id": id, "email": email, "role": role, "created_at": created})
	}
	s.controlListResponse(c, data)
}

func (s *Server) createUser(c *gin.Context) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Email == "" || len(in.Password) < 8 || (in.Role != "ADMIN" && in.Role != "OPERATOR") {
		c.JSON(400, errorBody("INVALID_REQUEST", "email, 8+ character password, and valid role are required"))
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(500, errorBody("PASSWORD_ERROR", "could not secure password"))
		return
	}
	id := platform.NewID("usr")
	_, err = s.db.Exec(c, `INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)`, id, strings.ToLower(in.Email), string(hash), in.Role)
	if err != nil {
		c.JSON(409, errorBody("EMAIL_EXISTS", "email already exists"))
		return
	}
	c.JSON(201, gin.H{"id": id, "email": strings.ToLower(in.Email), "role": in.Role})
}
