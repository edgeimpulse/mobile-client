import * as sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
    sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT,
    });
    sentry.setTag("k8s_namespace", process.env.K8S_NAMESPACE || '');
    sentry.setTag("git_commit_hash", process.env.GIT_COMMIT_HASH || '');
}
