// The package's own name and version, for the instrumentation scope of the
// OpenTelemetry tracer and meter: a relative require of package.json would
// bundle the whole manifest into ./otel. tests/unit/version.test.js keeps it
// equal to package.json, and the release process bumps both.
module.exports = { name: '@alexify/mailer', version: '0.0.1' };
