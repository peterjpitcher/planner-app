#!/usr/bin/env bash
# Throwaway-database test for the email_follow_ups retirement migration
# (supabase/migrations/20260918105144_retire_email_follow_ups.sql) and its
# restore (supabase/restore/restore_email_follow_ups.sql).
#
# Not part of `npm test`: the migration carries its own BEGIN and COMMIT, so it
# needs a database of its own. This script creates one, runs
# supabase/__tests__/retire-email-follow-ups.sql against it with ON_ERROR_STOP,
# and always drops it again, pass or fail.
#
# Usage:
#   supabase/__tests__/run-retire-email-follow-ups.sh
#
# Environment (all optional):
#   PGHOST   default 127.0.0.1. Must be local: the script refuses anything else.
#   PGPORT   default 55432, the local PostgreSQL 17 test cluster
#            (see tasks/fix-function/2026-09-05-discovery-repairs/migration-approval.md).
#   PGUSER   default postgres, the role that applies migrations on live.
#            Needs superuser: the test creates the Supabase roles and uses SET ROLE.
#   PGDATA   a PostgreSQL data directory. If nothing is listening on PGPORT,
#            the script starts this cluster with pg_ctl and stops it at the end.
#   PG_BIN   directory holding psql, pg_ctl and pg_isready. Defaults to
#            Homebrew's postgresql@17 when present, otherwise PATH.
#
# To make a throwaway cluster the first time:
#   initdb -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C
#
# The anon, authenticated and service_role roles are created in the cluster if
# missing. They are cluster-wide, so they are left in place for other harnesses.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CREATE_SQL="$REPO_ROOT/supabase/migrations/20260915000001_email_follow_ups.sql"
RETIRE_SQL="$REPO_ROOT/supabase/migrations/20260918105144_retire_email_follow_ups.sql"
RESTORE_SQL="$REPO_ROOT/supabase/restore/restore_email_follow_ups.sql"
TEST_SQL="$SCRIPT_DIR/retire-email-follow-ups.sql"

for f in "$CREATE_SQL" "$RETIRE_SQL" "$RESTORE_SQL" "$TEST_SQL"; do
  [ -f "$f" ] || { echo "Missing file: $f" >&2; exit 2; }
done

if [ -z "${PG_BIN:-}" ] && [ -x /opt/homebrew/opt/postgresql@17/bin/psql ]; then
  PG_BIN=/opt/homebrew/opt/postgresql@17/bin
fi
if [ -n "${PG_BIN:-}" ]; then
  export PATH="$PG_BIN:$PATH"
fi

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-55432}"
export PGUSER="${PGUSER:-postgres}"
unset PGDATABASE PGSERVICE

# Fail closed: this creates and drops databases, so never point it at anything remote.
case "$PGHOST" in
  127.0.0.1|localhost|::1|/*) ;;
  *) echo "Refusing to run against PGHOST=$PGHOST: local servers only." >&2; exit 2 ;;
esac

STARTED_SERVER=0
DB=""

cleanup() {
  local status=$?
  set +e
  if [ -n "$DB" ]; then
    psql -X -q -d postgres -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null
    remaining="$(psql -X -At -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = '$DB'")"
    if [ "$remaining" = "0" ]; then
      echo "Dropped throwaway database $DB"
    else
      echo "WARNING: throwaway database $DB could not be dropped" >&2
      status=1
    fi
  fi
  if [ "$STARTED_SERVER" = "1" ]; then
    pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null && echo "Stopped the cluster at $PGDATA"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT"; then
  if [ -z "${PGDATA:-}" ]; then
    echo "No PostgreSQL server on $PGHOST:$PGPORT, and PGDATA is not set to start one." >&2
    echo "Create a throwaway cluster with: initdb -D <dir> -U postgres --auth=trust -E UTF8 --locale=C" >&2
    echo "then rerun with PGDATA=<dir>." >&2
    exit 2
  fi
  echo "Starting the cluster at $PGDATA on port $PGPORT"
  # macOS: without a valid LC_ALL the postmaster refuses to start
  # ("postmaster became multithreaded during startup").
  LC_ALL="${LC_ALL:-C}" pg_ctl -D "$PGDATA" -o "-p $PGPORT" -l "${PGDATA%/}.log" -w start >/dev/null
  STARTED_SERVER=1
fi

SERVER_VERSION="$(psql -X -At -d postgres -c 'SHOW server_version_num')"
if [ "$SERVER_VERSION" -lt 150000 ]; then
  echo "PostgreSQL 15 or later is needed (ON DELETE SET NULL (column) in 20260915000001); found $SERVER_VERSION" >&2
  exit 2
fi
echo "Server: $(psql -X -At -d postgres -c 'SELECT version()')"
echo "Role:   $PGUSER on $PGHOST:$PGPORT"

DB="planner_retire_efu_$(date -u +%Y%m%d%H%M%S)_$$"
psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB\"" >/dev/null
echo "Created throwaway database $DB"
echo

# Child psql processes started by the test (for the runs that must fail) inherit
# these, so they reach the same database.
export PGDATABASE="$DB"

psql -X -v ON_ERROR_STOP=1 \
  -v create_sql="$CREATE_SQL" \
  -v retire_sql="$RETIRE_SQL" \
  -v restore_sql="$RESTORE_SQL" \
  -f "$TEST_SQL"

echo
echo "run-retire-email-follow-ups: PASSED"
