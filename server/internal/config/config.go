package config

import (
	"fmt"
	"os"
)

type Config struct {
	Addr     string
	MySQLDSN string
}

func FromEnv() Config {
	addr := getenv("SERVER_ADDR", "127.0.0.1:1234")
	dsn := os.Getenv("MYSQL_DSN")
	if dsn == "" {
		dsn = fmt.Sprintf(
			"%s:%s@tcp(%s:%s)/%s?parseTime=true&loc=Local&charset=utf8mb4,utf8",
			getenv("MYSQL_USER", "caixin_app"),
			getenv("MYSQL_PASSWORD", "caixin_app_password"),
			getenv("MYSQL_HOST", "127.0.0.1"),
			getenv("MYSQL_PORT", "3307"),
			getenv("MYSQL_DATABASE", "enhanced_caixin"),
		)
	}

	return Config{
		Addr:     addr,
		MySQLDSN: dsn,
	}
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
