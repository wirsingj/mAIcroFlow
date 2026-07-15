package main

import (
	"encoding/json"
	"fmt"
	"io"
	"maicroflow/internal/core"
	"os"
)

func main() {
	args := os.Args[1:]
	if len(args) > 0 && args[0] == "--" {
		args = args[1:]
	}
	if len(args) == 0 {
		fail("expected command")
	}

	switch args[0] {
	case "validate-workflows":
		if len(args) != 2 {
			fail("usage: validate-workflows <path>")
		}
		if _, err := core.LoadAndValidateWorkflows(args[1]); err != nil {
			fail(err.Error())
		}
		fmt.Println(`{"ok":true}`)
	case "extract-fishing":
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			fail(err.Error())
		}
		writeJSON(core.ExtractFishingResult(string(data)))
	case "append-fishing-row":
		if len(args) != 2 {
			fail("usage: append-fishing-row <csv-path>")
		}
		var row core.FishingRow
		if err := json.NewDecoder(os.Stdin).Decode(&row); err != nil {
			fail(err.Error())
		}
		if err := core.AppendFishingRow(args[1], row); err != nil {
			fail(err.Error())
		}
		fmt.Println(`{"ok":true}`)
	default:
		fail("unknown command: " + args[0])
	}
}

func writeJSON(value any) {
	encoder := json.NewEncoder(os.Stdout)
	if err := encoder.Encode(value); err != nil {
		fail(err.Error())
	}
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
