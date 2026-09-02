package scenarios

import "testing"

func TestConfigValidate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		config  Config
		wantErr bool
	}{
		{name: "accepts boundary probabilities", config: Config{APISlowProbability: 100, APIRandom500Probability: 0, APITimeoutProbability: 100}},
		{name: "rejects negative delay", config: Config{APISlowMS: -1}, wantErr: true},
		{name: "rejects negative webhook delay", config: Config{WebhookDelaySeconds: -1}, wantErr: true},
		{name: "rejects probability above one hundred", config: Config{APIRandom500Probability: 101}, wantErr: true},
		{name: "rejects negative probability", config: Config{APITimeoutProbability: -1}, wantErr: true},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := test.config.Validate()
			if (err != nil) != test.wantErr {
				t.Fatalf("Validate() error = %v, want error = %v", err, test.wantErr)
			}
		})
	}
}
