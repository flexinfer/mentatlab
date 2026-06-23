// k6 load test for MentatLab Orchestrator API
// Usage: k6 run tests/load/orchestrator.js
//
// Environment variables:
//   ORCH_URL - Orchestrator base URL (default: http://localhost:7070)
//   API_KEY  - API key for authentication (optional)

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.ORCH_URL || 'http://localhost:7070';
const API_KEY = __ENV.API_KEY || '';

// Custom metrics
const createRunDuration = new Trend('create_run_duration', true);
const listRunsDuration = new Trend('list_runs_duration', true);
const getRunDuration = new Trend('get_run_duration', true);
const errorRate = new Rate('errors');

// Test scenarios
export const options = {
  scenarios: {
    // Scenario 1: CRUD throughput
    crud: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '10s', target: 0 },
      ],
      exec: 'crudTest',
    },
    // Scenario 2: Concurrent run execution
    concurrent_runs: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      exec: 'concurrentRunsTest',
      startTime: '50s',
    },
    // Scenario 3: List pagination stress
    pagination: {
      executor: 'constant-vus',
      vus: 3,
      duration: '20s',
      exec: 'paginationTest',
      startTime: '80s',
    },
  },
  thresholds: {
    'create_run_duration': ['p(95)<200'], // 95th percentile < 200ms
    'list_runs_duration': ['p(95)<300'],
    'get_run_duration': ['p(95)<100'],
    'errors': ['rate<0.05'], // <5% error rate
  },
};

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (API_KEY) {
    h['Authorization'] = `Bearer ${API_KEY}`;
  }
  return h;
}

// Scenario 1: CRUD operations
export function crudTest() {
  group('Create Run', () => {
    const payload = JSON.stringify({
      name: `load-test-${Date.now()}`,
      plan: {
        nodes: [
          { id: 'n1', type: 'agent', agent_id: 'mentatlab.echo' },
        ],
      },
    });

    const res = http.post(`${BASE_URL}/api/v1/runs`, payload, { headers: headers() });
    createRunDuration.add(res.timings.duration);
    const success = check(res, {
      'create: status 201': (r) => r.status === 201,
      'create: has runId': (r) => JSON.parse(r.body).runId !== undefined,
    });
    errorRate.add(!success);

    if (res.status === 201) {
      const runId = JSON.parse(res.body).runId;

      // Get run
      const getRes = http.get(`${BASE_URL}/api/v1/runs/${runId}`, { headers: headers() });
      getRunDuration.add(getRes.timings.duration);
      check(getRes, { 'get: status 200': (r) => r.status === 200 });

      // Delete run
      http.del(`${BASE_URL}/api/v1/runs/${runId}`, null, { headers: headers() });
    }
  });

  sleep(0.1);
}

// Scenario 2: Concurrent run execution
export function concurrentRunsTest() {
  const payload = JSON.stringify({
    name: `concurrent-${__VU}-${__ITER}`,
    plan: {
      nodes: [
        { id: 'n1', type: 'agent', agent_id: 'mentatlab.echo', command: ['echo', 'hello'] },
      ],
    },
    auto_start: true,
  });

  const res = http.post(`${BASE_URL}/api/v1/runs`, payload, { headers: headers() });
  check(res, {
    'concurrent: created': (r) => r.status === 201,
  });

  if (res.status === 201) {
    const runId = JSON.parse(res.body).runId;

    // Poll until complete (max 10s)
    let attempts = 0;
    while (attempts < 20) {
      const status = http.get(`${BASE_URL}/api/v1/runs/${runId}`, { headers: headers() });
      if (status.status === 200) {
        const run = JSON.parse(status.body);
        if (['succeeded', 'failed'].includes(run.status)) break;
      }
      sleep(0.5);
      attempts++;
    }
  }

  sleep(0.5);
}

// Scenario 3: Pagination stress
export function paginationTest() {
  group('List Runs (paginated)', () => {
    // Cursor-based
    const res = http.get(`${BASE_URL}/api/v1/runs?limit=10`, { headers: headers() });
    listRunsDuration.add(res.timings.duration);
    const success = check(res, {
      'list: status 200': (r) => r.status === 200,
      'list: has runs': (r) => JSON.parse(r.body).runs !== undefined,
    });
    errorRate.add(!success);

    // If there's a next_cursor, follow it
    if (res.status === 200) {
      const body = JSON.parse(res.body);
      if (body.next_cursor) {
        const nextRes = http.get(
          `${BASE_URL}/api/v1/runs?limit=10&cursor=${body.next_cursor}`,
          { headers: headers() }
        );
        check(nextRes, { 'list next: status 200': (r) => r.status === 200 });
      }
    }
  });

  group('List Flows', () => {
    const res = http.get(`${BASE_URL}/api/v1/flows?limit=10`, { headers: headers() });
    check(res, { 'flows list: status 200': (r) => r.status === 200 });
  });

  sleep(0.2);
}
