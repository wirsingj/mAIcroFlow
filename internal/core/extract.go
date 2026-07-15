package core

import (
	"regexp"
	"strings"
)

func NormalizeExtraction(input ExtractionResult) ExtractionResult {
	if input.Confidence < 0 {
		input.Confidence = 0
	}
	if input.Confidence > 1 {
		input.Confidence = 1
	}

	input.FishName = clean(input.FishName)
	input.ExpGained = clean(input.ExpGained)
	input.Weight = clean(input.Weight)
	input.ClassTier = clean(input.ClassTier)
	input.BaitUsed = clean(input.BaitUsed)
	input.Notes = clean(input.Notes)
	return input
}

func ExtractFishingResult(text string) ExtractionResult {
	text = strings.TrimSpace(text)
	if text == "" {
		return NormalizeExtraction(ExtractionResult{
			FishName:   "Unverified catch",
			Confidence: 0.35,
			Notes:      "Deterministic fallback: no readable text hints were supplied, so please edit the preview before saving.",
		})
	}

	return NormalizeExtraction(ExtractionResult{
		FishName:   regexValue(text, `(?i)(?:fish|catch|name)\s*[:\-]\s*([^\n,]+)`),
		ExpGained:  regexValue(text, `(?i)(?:exp|xp|experience)\s*(?:gained)?\s*[:+\-]?\s*([0-9,]+)`),
		Weight:     regexValue(text, `(?i)(?:weight|wt)\s*[:\-]?\s*([0-9.]+\s*(?:kg|lb|lbs)?)`),
		ClassTier:  regexValue(text, `(?i)(?:class|tier|rank)\s*[:\-]\s*([^\n,]+)`),
		BaitUsed:   regexValue(text, `(?i)(?:bait|lure)\s*[:\-]\s*([^\n,]+)`),
		Confidence: 0.72,
		Notes:      "Parsed from supplied text using deterministic regex rules.",
	})
}

func regexValue(text string, pattern string) string {
	matches := regexp.MustCompile(pattern).FindStringSubmatch(text)
	if len(matches) < 2 {
		return ""
	}
	return strings.TrimSpace(matches[1])
}

func clean(value string) string {
	return strings.Join(strings.Fields(value), " ")
}
