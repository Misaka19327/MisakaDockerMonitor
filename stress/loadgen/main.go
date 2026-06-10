package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type logEntry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Container string `json:"container"`
	Sequence  int64  `json:"sequence"`
	Message   string `json:"message"`
	Padding   string `json:"padding,omitempty"`
}

func getenvInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}

	return parsed
}

func getenvString(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func main() {
	rate := getenvInt("RATE", 100)
	payloadBytes := getenvInt("PAYLOAD_BYTES", 256)
	containerName := getenvString("CONTAINER_NAME", getenvString("HOSTNAME", "loadgen"))
	format := strings.ToLower(getenvString("LOG_FORMAT", "json"))
	padding := ""

	if payloadBytes > 0 {
		padding = strings.Repeat("x", payloadBytes)
	}

	interval := time.Second / time.Duration(rate)
	if interval <= 0 {
		interval = time.Millisecond
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	var sequence int64
	for tick := range ticker.C {
		sequence++
		if format == "text" {
			fmt.Printf("%s level=info container=%s seq=%d message=stress-log padding=%s\n",
				tick.UTC().Format(time.RFC3339Nano),
				containerName,
				sequence,
				padding,
			)
			continue
		}

		entry := logEntry{
			Timestamp: tick.UTC().Format(time.RFC3339Nano),
			Level:     "info",
			Container: containerName,
			Sequence:  sequence,
			Message:   "stress-log",
			Padding:   padding,
		}

		encoded, err := json.Marshal(entry)
		if err != nil {
			fmt.Fprintf(os.Stderr, "{\"level\":\"error\",\"message\":\"marshal failed\",\"error\":%q}\n", err.Error())
			continue
		}

		fmt.Println(string(encoded))
	}
}
