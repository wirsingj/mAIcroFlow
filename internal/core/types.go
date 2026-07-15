package core

type Workflow struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Status     string         `json:"status"`
	Trigger    WorkflowTrigger `json:"trigger"`
	Nodes      []WorkflowNode  `json:"nodes"`
	LastRun    string         `json:"lastRun,omitempty"`
	LastResult string         `json:"lastResult,omitempty"`
}

type WorkflowTrigger struct {
	Kind    string `json:"kind"`
	Summary string `json:"summary"`
	Hotkey  string `json:"hotkey,omitempty"`
}

type WorkflowNode struct {
	ID      string         `json:"id"`
	Type    string         `json:"type"`
	Title   string         `json:"title"`
	Summary string         `json:"summary"`
	Config  map[string]any `json:"config"`
}

type ExtractionResult struct {
	FishName   string  `json:"fish_name"`
	ExpGained  string  `json:"exp_gained"`
	Weight     string  `json:"weight"`
	ClassTier  string  `json:"class_tier"`
	BaitUsed   string  `json:"bait_used"`
	Confidence float64 `json:"confidence"`
	Notes      string  `json:"notes"`
}

type FishingRow struct {
	Timestamp      string  `json:"timestamp"`
	WorkflowName  string  `json:"workflow_name"`
	FishName      string  `json:"fish_name"`
	ExpGained     string  `json:"exp_gained"`
	Weight        string  `json:"weight"`
	ClassTier     string  `json:"class_tier"`
	BaitUsed      string  `json:"bait_used"`
	Confidence    float64 `json:"confidence"`
	ScreenshotPath string `json:"screenshot_path"`
	Notes         string  `json:"notes"`
}
