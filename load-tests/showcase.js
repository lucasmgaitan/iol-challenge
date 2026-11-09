import { sleep } from 'k6';
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

const Endpoint = {
  TokenBucket: '/hello',
  SlidingWindow: '/hello-window',
};

const Client = {
  Steady: '198.51.100.20',
  Bursty: '198.51.100.21',
  Spike: '198.51.100.22',
  Compare: '198.51.100.23',
};

const FORWARDED_FOR_HEADER = 'X-Forwarded-For';
const OK_STATUS = 200;
const TOO_MANY_REQUESTS_STATUS = 429;

const DURATION = '60s';
const BURST_SIZE = 8;
const BURST_INTERVAL_S = 10;
const SPIKE_SIZE = 30;
const SPIKE_START = '12s';
const COMPARE_BURST_SIZE = 5;
const COMPARE_INTERVAL_S = 3;

http.setResponseCallback(http.expectedStatuses(OK_STATUS, TOO_MANY_REQUESTS_STATUS));

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: 1,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 2,
      exec: 'steady',
    },
    bursty: { executor: 'constant-vus', vus: 1, duration: DURATION, exec: 'bursty' },
    spike: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      startTime: SPIKE_START,
      exec: 'spike',
    },
    compare: { executor: 'constant-vus', vus: 1, duration: DURATION, exec: 'compare' },
  },
};

function request(endpoint, client) {
  return {
    method: 'GET',
    url: `${BASE_URL}${endpoint}`,
    params: { headers: { [FORWARDED_FOR_HEADER]: client }, tags: { endpoint } },
  };
}

function burst(endpoint, client, size) {
  http.batch(Array.from({ length: size }, () => request(endpoint, client)));
}

export function steady() {
  const { method, url, params } = request(Endpoint.TokenBucket, Client.Steady);
  http.request(method, url, null, params);
}

export function bursty() {
  burst(Endpoint.TokenBucket, Client.Bursty, BURST_SIZE);
  sleep(BURST_INTERVAL_S);
}

export function spike() {
  burst(Endpoint.TokenBucket, Client.Spike, SPIKE_SIZE);
}

export function compare() {
  burst(Endpoint.TokenBucket, Client.Compare, COMPARE_BURST_SIZE);
  burst(Endpoint.SlidingWindow, Client.Compare, COMPARE_BURST_SIZE);
  sleep(COMPARE_INTERVAL_S);
}
