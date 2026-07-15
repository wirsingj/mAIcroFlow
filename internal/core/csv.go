package core

import (
	"encoding/csv"
	"errors"
	"os"
	"path/filepath"
	"strconv"
)

var FishingCSVColumns = []string{
	"timestamp",
	"workflow_name",
	"fish_name",
	"exp_gained",
	"weight",
	"class_tier",
	"bait_used",
	"confidence",
	"screenshot_path",
	"notes",
}

func AppendFishingRow(path string, row FishingRow) error {
	if path == "" {
		return errors.New("csv path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	needsHeader := true
	if stat, err := os.Stat(path); err == nil && stat.Size() > 0 {
		needsHeader = false
	}

	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	if needsHeader {
		if err := writer.Write(FishingCSVColumns); err != nil {
			return err
		}
	}

	return writer.Write([]string{
		row.Timestamp,
		row.WorkflowName,
		row.FishName,
		row.ExpGained,
		row.Weight,
		row.ClassTier,
		row.BaitUsed,
		strconv.FormatFloat(row.Confidence, 'f', -1, 64),
		row.ScreenshotPath,
		row.Notes,
	})
}
