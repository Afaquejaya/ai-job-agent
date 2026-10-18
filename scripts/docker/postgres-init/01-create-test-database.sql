-- Runs once, when the Postgres volume is first created.
-- Integration and e2e tests use this database so they never touch development data.
CREATE DATABASE job_agent_test;
