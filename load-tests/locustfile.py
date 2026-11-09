import itertools

from locust import FastHttpUser, constant, constant_throughput, events, task
from prometheus_client import Counter, Gauge, start_http_server

METRICS_PORT = 9646
FORWARDED_FOR_HEADER = "X-Forwarded-For"
OK_STATUS = 200
TOO_MANY_REQUESTS_STATUS = 429
RATE_LIMITED_MESSAGE = "rate limited"
SPIKE_IDLE_S = 3600


class Endpoint:
    TOKEN_BUCKET = "/hello"
    SLIDING_WINDOW = "/hello-window"


class Label:
    PROFILE = "profile"
    ENDPOINT = "endpoint"
    STATUS = "status"


REQUESTS = Counter(
    "locust_requests",
    "Requests sent by Locust, by profile, endpoint and status code",
    [Label.PROFILE, Label.ENDPOINT, Label.STATUS],
)
USERS = Gauge("locust_users", "Active Locust users by profile", [Label.PROFILE])

client_numbers = itertools.count(1)


def next_client_ip():
    number = next(client_numbers)
    return f"10.{(number >> 16) & 255}.{(number >> 8) & 255}.{number & 255}"


@events.init_command_line_parser.add_listener
def add_arguments(parser):
    parser.add_argument(
        "--endpoint",
        choices=[Endpoint.TOKEN_BUCKET, Endpoint.SLIDING_WINDOW],
        default=Endpoint.TOKEN_BUCKET,
        include_in_web_ui=True,
        help="/hello is a token bucket (5, 1/s); /hello-window is a sliding window (5 per 5 s)",
    )
    parser.add_argument("--steady-rate", type=float, default=1, include_in_web_ui=True,
                        help="Steady: requests per second per user")
    parser.add_argument("--greedy-rate", type=float, default=10, include_in_web_ui=True,
                        help="Greedy: requests per second per user")
    parser.add_argument("--burst-size", type=int, default=8, include_in_web_ui=True,
                        help="Bursty: requests per burst")
    parser.add_argument("--burst-interval", type=float, default=10, include_in_web_ui=True,
                        help="Bursty: seconds between bursts")
    parser.add_argument("--spike-size", type=int, default=30, include_in_web_ui=True,
                        help="Spike: requests sent once when the user starts")


@events.init.add_listener
def expose_metrics(**_):
    start_http_server(METRICS_PORT)


class RateLimitedUser(FastHttpUser):
    abstract = True
    profile = ""

    def on_start(self):
        self.client_ip = next_client_ip()
        USERS.labels(self.profile).inc()

    def on_stop(self):
        USERS.labels(self.profile).dec()

    @property
    def options(self):
        return self.environment.parsed_options

    def hello(self):
        endpoint = self.options.endpoint
        with self.client.get(
            endpoint,
            headers={FORWARDED_FOR_HEADER: self.client_ip},
            name=f"{self.profile} {endpoint}",
            catch_response=True,
        ) as response:
            REQUESTS.labels(self.profile, endpoint, str(response.status_code)).inc()
            if response.status_code == TOO_MANY_REQUESTS_STATUS:
                response.failure(RATE_LIMITED_MESSAGE)
            elif response.status_code == OK_STATUS:
                response.success()

    def send(self, requests):
        for _ in range(requests):
            self.hello()


class Steady(RateLimitedUser):
    profile = "steady"

    def wait_time(self):
        return constant_throughput(self.options.steady_rate)(self)

    @task
    def request(self):
        self.hello()


class Greedy(RateLimitedUser):
    profile = "greedy"

    def wait_time(self):
        return constant_throughput(self.options.greedy_rate)(self)

    @task
    def request(self):
        self.hello()


class Bursty(RateLimitedUser):
    profile = "bursty"

    def wait_time(self):
        return constant(self.options.burst_interval)(self)

    @task
    def burst(self):
        self.send(self.options.burst_size)


class Spike(RateLimitedUser):
    profile = "spike"
    wait_time = constant(SPIKE_IDLE_S)

    @task
    def spike(self):
        self.send(self.options.spike_size)
