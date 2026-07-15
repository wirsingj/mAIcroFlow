package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

var allowedStatuses = map[string]bool{"active": true, "paused": true, "disabled": true}
var requiredNodeTypes = []string{"trigger", "capture", "extract", "confirm", "action"}

func LoadAndValidateWorkflows(path string) ([]Workflow, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var workflows []Workflow
	if err := json.Unmarshal(data, &workflows); err != nil {
		return nil, err
	}

	for i := range workflows {
		if err := ValidateWorkflow(workflows[i]); err != nil {
			return nil, fmt.Errorf("workflow %d: %w", i, err)
		}
	}

	return workflows, nil
}

func ValidateWorkflow(workflow Workflow) error {
	if workflow.ID == "" {
		return errors.New("id is required")
	}
	if workflow.Name == "" {
		return errors.New("name is required")
	}
	if !allowedStatuses[workflow.Status] {
		return fmt.Errorf("status %q is invalid", workflow.Status)
	}
	if workflow.Trigger.Kind == "" || workflow.Trigger.Summary == "" {
		return errors.New("trigger kind and summary are required")
	}
	if len(workflow.Nodes) == 0 {
		return errors.New("at least one node is required")
	}

	seen := map[string]bool{}
	for _, node := range workflow.Nodes {
		if node.ID == "" || node.Type == "" || node.Title == "" || node.Summary == "" {
			return errors.New("every node needs id, type, title, and summary")
		}
		seen[node.Type] = true
	}

	for _, nodeType := range requiredNodeTypes {
		if !seen[nodeType] {
			return fmt.Errorf("missing required %s node", nodeType)
		}
	}

	return nil
}
