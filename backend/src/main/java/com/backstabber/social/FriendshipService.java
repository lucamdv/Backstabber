package com.backstabber.social;

import java.util.List;
import java.util.UUID;

import com.backstabber.api.ApiFailure;
import com.backstabber.persistence.TransactionLimits;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FriendshipService {
    private final FriendshipRepository repository;
    private final JdbcTemplate jdbc;

    public FriendshipService(FriendshipRepository repository, JdbcTemplate jdbc) {
        this.repository = repository;
        this.jdbc = jdbc;
    }

    public record Friendships(List<FriendshipRepository.Friend> friends, List<FriendshipRepository.PendingRequest> requests) {}
    public record CreatedRequest(UUID id) {}
    public record RequestStatus(String status) {}
    public record Removal(boolean ok) {}

    @Transactional(readOnly = true, timeout = 8)
    public Friendships list(UUID user) {
        TransactionLimits.apply(jdbc);
        return new Friendships(repository.friends(user), repository.pendingRequests(user));
    }

    @Transactional(timeout = 8)
    public CreatedRequest request(UUID user, UUID target) {
        TransactionLimits.apply(jdbc);
        if (user.equals(target)) throw new ApiFailure(HttpStatus.BAD_REQUEST, "INVALID_FRIEND_TARGET");
        lockProfiles(user, target);
        if (repository.areFriends(user, target)) throw new ApiFailure(HttpStatus.CONFLICT, "ALREADY_FRIENDS");
        UUID id = repository.createRequest(user, target)
                .orElseThrow(() -> new ApiFailure(HttpStatus.CONFLICT, "FRIEND_REQUEST_EXISTS"));
        return new CreatedRequest(id);
    }

    @Transactional(timeout = 8)
    public RequestStatus respond(UUID user, UUID requestId, boolean accept) {
        TransactionLimits.apply(jdbc);
        UUID sender = repository.pendingSender(requestId, user).orElseThrow(FriendshipService::requestNotFound);
        lockProfiles(sender, user);
        String status = accept ? "accepted" : "declined";
        // A concurrent response may have resolved it while we were waiting for the profiles.
        if (!repository.respond(requestId, user, status)) throw requestNotFound();
        if (accept) repository.createFriendship(sender, user);
        return new RequestStatus(status);
    }

    @Transactional(timeout = 8)
    public Removal remove(UUID user, UUID target) {
        TransactionLimits.apply(jdbc);
        repository.removeFriendship(user, target);
        return new Removal(true);
    }

    private void lockProfiles(UUID first, UUID second) {
        if (!repository.lockProfiles(first, second)) throw new ApiFailure(HttpStatus.NOT_FOUND, "PROFILE_NOT_FOUND");
    }

    private static ApiFailure requestNotFound() {
        return new ApiFailure(HttpStatus.NOT_FOUND, "FRIEND_REQUEST_NOT_FOUND");
    }
}
