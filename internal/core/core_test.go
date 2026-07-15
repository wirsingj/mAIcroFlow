package core

import (
	"encoding/csv"
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeExtractionClampsConfidence(t *testing.T) {
	result := NormalizeExtraction(ExtractionResult{
		FishName:   "  River   Pike ",
		Confidence: 2.4,
	})

	if result.FishName != "River Pike" {
		t.Fatalf("expected collapsed fish name, got %q", result.FishName)
	}
	if result.Confidence != 1 {
		t.Fatalf("expected confidence 1, got %f", result.Confidence)
	}
}

func TestExtractFishingResultParsesManualText(t *testing.T) {
	result := ExtractFishingResult("Fish: Glacier Trout\nEXP: 140\nWeight: 2.6 lb\nTier: Rare\nBait: Minnow")

	if result.FishName != "Glacier Trout" || result.ExpGained != "140" || result.BaitUsed != "Minnow" {
		t.Fatalf("unexpected extraction: %+v", result)
	}
}

func TestAppendFishingRowWritesHeaderAndRow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fishing.csv")
	err := AppendFishingRow(path, FishingRow{
		Timestamp:      "2026-05-10T00:00:00Z",
		WorkflowName:  "Fishing Logger Demo",
		FishName:      "Glacier Trout",
		ExpGained:     "140",
		Weight:        "2.6 lb",
		ClassTier:     "Rare",
		BaitUsed:      "Minnow",
		Confidence:    0.72,
		ScreenshotPath: "capture.png",
		Notes:         "ok",
	})
	if err != nil {
		t.Fatal(err)
	}

	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	records, err := csv.NewReader(file).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 {
		t.Fatalf("expected header and one row, got %d records", len(records))
	}
	if records[1][2] != "Glacier Trout" {
		t.Fatalf("expected fish name column, got %q", records[1][2])
	}
}

func TestValidateWorkflowRequiresCoreNodes(t *testing.T) {
	workflow := Workflow{
		ID:      "demo",
		Name:    "Demo",
		Status:  "active",
		Trigger: WorkflowTrigger{Kind: "hotkey", Summary: "F12"},
		Nodes: []WorkflowNode{
			{ID: "t", Type: "trigger", Title: "Trigger", Summary: "F12"},
			{ID: "c", Type: "capture", Title: "Capture", Summary: "Screen"},
			{ID: "e", Type: "extract", Title: "Extract", Summary: "Parse"},
			{ID: "v", Type: "confirm", Title: "Confirm", Summary: "Preview"},
			{ID: "a", Type: "action", Title: "Action", Summary: "CSV"},
		},
	}

	if err := ValidateWorkflow(workflow); err != nil {
		t.Fatal(err)
	}
}
