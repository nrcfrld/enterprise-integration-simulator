package server

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

type pageCursor struct {
	Sort      string `json:"sort"`
	Direction string `json:"direction"`
	Value     string `json:"value"`
	ID        string `json:"id"`
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
