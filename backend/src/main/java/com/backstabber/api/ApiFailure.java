package com.backstabber.api;

import org.springframework.http.HttpStatus;

public final class ApiFailure extends RuntimeException {
    private final HttpStatus status;

    public ApiFailure(HttpStatus status, String code) {
        super(code);
        this.status = status;
    }

    public HttpStatus status() {
        return status;
    }

    public static ApiFailure unauthenticated() {
        return new ApiFailure(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
    }

    public static ApiFailure unavailable() {
        return new ApiFailure(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE");
    }

    public static ApiFailure internal() {
        return new ApiFailure(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR");
    }
}
