package com.backstabber.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionSynchronizationManager;

public final class TransactionLimits {
    private TransactionLimits() {}

    public static void apply(JdbcTemplate jdbc) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("Transaction limits require an active transaction.");
        }
        jdbc.execute("set local lock_timeout = '3s'");
        jdbc.execute("set local statement_timeout = '8s'");
        jdbc.execute("set local idle_in_transaction_session_timeout = '10s'");
    }
}
