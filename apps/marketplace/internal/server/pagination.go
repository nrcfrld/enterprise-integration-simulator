package server

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type pageCursor struct {
	Sort      string `json:"sort"`
	Direction string `json:"direction"`
	Value     string `json:"value"`
	ID        string `json:"id"`
}

func page(c *gin.Context) (int, string) {
	limit := 50
	if parsed, err := strconv.Atoi(c.DefaultQuery("limit", "50")); err == nil && parsed > 0 && parsed <= 100 {
		limit = parsed
	}
	return limit, c.Query("cursor")
}

func sortClause(c *gin.Context, allowed map[string]string, fallback string) (string, error) {
	field := c.DefaultQuery("sort", fallback)
	column, ok := allowed[field]
	if !ok {
		return "", fmt.Errorf("sort must be one of: %s", strings.Join(mapKeys(allowed), ", "))
	}
	direction := strings.ToUpper(c.DefaultQuery("direction", "DESC"))
	if direction != "ASC" && direction != "DESC" {
		return "", fmt.Errorf("direction must be ASC or DESC")
	}
	return column + " " + direction, nil
}

func mapKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}

func respondPage(c *gin.Context, data []gin.H, limit int, sort, direction string) {
	hasMore := len(data) > limit
	if hasMore {
		data = data[:limit]
	}
	next := ""
	if hasMore {
		next, _ = encodeCursor(pageCursor{Sort: sort, Direction: direction, Value: cursorValue(data[len(data)-1][sort]), ID: data[len(data)-1]["id"].(string)})
	}
	c.JSON(200, gin.H{"data": data, "pagination": gin.H{"next_cursor": next, "has_more": hasMore}})
}

func encodeCursor(cursor pageCursor) (string, error) {
	raw, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func decodeCursor(raw, sort, direction string) (pageCursor, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return pageCursor{}, fmt.Errorf("cursor is malformed")
	}
	var cursor pageCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.ID == "" || cursor.Value == "" {
		return pageCursor{}, fmt.Errorf("cursor is malformed")
	}
	if cursor.Sort != sort || cursor.Direction != direction {
		return pageCursor{}, fmt.Errorf("cursor does not match the requested sort")
	}
	return cursor, nil
}

func applyCursor(args *[]any, where *string, raw, sort, direction string, parseValue func(string, string) (any, error)) error {
	if raw == "" {
		return nil
	}
	cursor, err := decodeCursor(raw, sort, direction)
	if err != nil {
		return err
	}
	value, err := parseValue(sort, cursor.Value)
	if err != nil {
		return err
	}
	operator := "<"
	if direction == "ASC" {
		operator = ">"
	}
	*args = append(*args, value, cursor.ID)
	*where += fmt.Sprintf(` AND (%s, id) %s ($%d, $%d)`, sort, operator, len(*args)-1, len(*args))
	return nil
}

func productCursorValue(sort, value string) (any, error) {
	if sort == "created_at" || sort == "updated_at" {
		return time.Parse(time.RFC3339Nano, value)
	}
	if sort == "price" || sort == "stock" {
		return strconv.ParseInt(value, 10, 64)
	}
	if sort == "name" || sort == "category" {
		return value, nil
	}
	return nil, fmt.Errorf("cursor has unsupported sort")
}

func orderCursorValue(sort, value string) (any, error) {
	if sort == "created_at" || sort == "updated_at" {
		return time.Parse(time.RFC3339Nano, value)
	}
	if sort == "total_amount" {
		return strconv.ParseInt(value, 10, 64)
	}
	if sort == "order_number" {
		return value, nil
	}
	return nil, fmt.Errorf("cursor has unsupported sort")
}

func cursorValue(value any) string {
	if timestamp, ok := value.(time.Time); ok {
		return timestamp.Format(time.RFC3339Nano)
	}
	return fmt.Sprint(value)
}
