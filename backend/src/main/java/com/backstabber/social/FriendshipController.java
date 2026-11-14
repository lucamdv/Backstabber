package com.backstabber.social;

import java.util.UUID;

import com.backstabber.api.RequestInput;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/friends")
public class FriendshipController {
    private final FriendshipService friendships;

    public FriendshipController(FriendshipService friendships) {
        this.friendships = friendships;
    }

    @GetMapping
    public FriendshipService.Friendships list(@AuthenticationPrincipal UUID user) {
        return friendships.list(user);
    }

    @PostMapping("/requests")
    public FriendshipService.CreatedRequest request(@AuthenticationPrincipal UUID user,
                                                    @RequestAttribute(RequestInput.ATTRIBUTE) RequestInput body) {
        return friendships.request(user, body.uuid("userId"));
    }

    @PostMapping("/requests/{id}/respond")
    public FriendshipService.RequestStatus respond(@AuthenticationPrincipal UUID user, @PathVariable("id") String id,
                                                    @RequestAttribute(RequestInput.ATTRIBUTE) RequestInput body) {
        return friendships.respond(user, RequestInput.uuidValue(id), body.requiredBoolean("accept"));
    }

    @DeleteMapping("/{userId}")
    public FriendshipService.Removal remove(@AuthenticationPrincipal UUID user, @PathVariable("userId") String target) {
        return friendships.remove(user, RequestInput.uuidValue(target));
    }
}
