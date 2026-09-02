package webhooks

import "time"

var retrySchedule = []time.Duration{30 * time.Second, 2 * time.Minute, 10 * time.Minute, 30 * time.Minute}

// RetryAfter returns the delay after a failed 1-based delivery attempt.
func RetryAfter(attempt int) time.Duration {
	if attempt < 1 {
		return retrySchedule[0]
	}
	if attempt > len(retrySchedule) {
		return retrySchedule[len(retrySchedule)-1]
	}
	return retrySchedule[attempt-1]
}
