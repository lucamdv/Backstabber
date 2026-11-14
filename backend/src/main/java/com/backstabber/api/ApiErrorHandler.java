package com.backstabber.api;

import java.sql.SQLException;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.TransactionSystemException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.HttpRequestMethodNotSupportedException;

@RestControllerAdvice
public class ApiErrorHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiErrorHandler.class);
    private static final Set<String> UNAVAILABLE_STATES = Set.of("55P03", "40P01", "57014", "40001", "53300", "57P01");

    public record ErrorBody(String error) {}

    @ExceptionHandler(ApiFailure.class)
    ResponseEntity<ErrorBody> apiFailure(ApiFailure failure) {
        return ResponseEntity.status(failure.status()).body(new ErrorBody(failure.getMessage()));
    }

    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class, HttpRequestMethodNotSupportedException.class})
    ResponseEntity<ErrorBody> notFound() {
        return apiFailure(new ApiFailure(HttpStatus.NOT_FOUND, "NOT_FOUND"));
    }

    @ExceptionHandler({DataAccessException.class, TransactionException.class})
    ResponseEntity<ErrorBody> databaseFailure(RuntimeException failure) {
        boolean unavailable = failure instanceof CannotCreateTransactionException
                || failure instanceof CannotGetJdbcConnectionException
                || hasUnavailableSqlState(failure)
                || failure instanceof TransactionSystemException transaction
                        && hasUnavailableSqlState(transaction.getApplicationException());
        if (unavailable) {
            log.atWarn().addKeyValue("type", failure.getClass().getSimpleName()).log("Database unavailable");
            return apiFailure(ApiFailure.unavailable());
        }
        return unexpected(failure);
    }

    private static boolean hasUnavailableSqlState(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && sql.getSQLState() != null
                    && (sql.getSQLState().startsWith("08") || UNAVAILABLE_STATES.contains(sql.getSQLState()))) {
                return true;
            }
        }
        return false;
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorBody> unexpected(Exception failure) {
        log.atError().addKeyValue("type", failure.getClass().getSimpleName()).log("API request failed");
        return apiFailure(ApiFailure.internal());
    }
}
