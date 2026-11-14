package com.backstabber.social;

import java.util.List;
import java.util.UUID;

import com.backstabber.api.RequestInput;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class InvitationController {
    private final InvitationService invitations;

    public InvitationController(InvitationService invitations) {
        this.invitations = invitations;
    }

    @GetMapping("/invites")
    public List<Invitation> pending(@AuthenticationPrincipal UUID user) {
        return invitations.pending(user);
    }

    @PostMapping("/invites/{id}/respond")
    public Object respond(@AuthenticationPrincipal UUID user, @PathVariable("id") String invitation,
            @RequestAttribute(RequestInput.ATTRIBUTE) RequestInput input) {
        return invitations.respond(user, RequestInput.uuidValue(invitation), input.requiredBoolean("accept"));
    }

    @PostMapping("/rooms/{id}/invite")
    public InvitationService.Created send(@AuthenticationPrincipal UUID user, @PathVariable("id") String room,
            @RequestAttribute(RequestInput.ATTRIBUTE) RequestInput input) {
        return invitations.send(user, RequestInput.uuidValue(room), input);
    }
}
