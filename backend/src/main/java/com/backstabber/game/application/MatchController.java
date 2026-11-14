package com.backstabber.game.application;

import com.backstabber.api.ApiFailure;
import com.backstabber.api.RequestInput;
import com.backstabber.game.model.GameModel.OnlineView;
import com.backstabber.lobby.RoomSnapshot;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
public class MatchController {
    private final MatchService matches;

    public MatchController(MatchService matches) {
        this.matches = matches;
    }

    @PostMapping("/rooms/{id}/start")
    public RoomSnapshot start(@AuthenticationPrincipal UUID userId, @PathVariable String id) {
        return matches.start(userId, RequestInput.uuidValue(id));
    }

    @RequestMapping("/matches/{id}")
    public OnlineView get(@AuthenticationPrincipal UUID userId, @PathVariable String id, HttpServletRequest request) {
        return matches.get(userId, matchId(id, request, "", "GET"));
    }

    @RequestMapping("/matches/{id}/commands")
    public JsonNode command(@AuthenticationPrincipal UUID userId, @PathVariable String id, HttpServletRequest request,
                            @RequestAttribute(value = RequestInput.ATTRIBUTE, required = false) RequestInput input) {
        return matches.command(userId, matchId(id, request, "/commands", "POST"), input);
    }

    @RequestMapping("/matches/{id}/rematch")
    public OnlineView rematch(@AuthenticationPrincipal UUID userId, @PathVariable String id, HttpServletRequest request) {
        return matches.rematch(userId, matchId(id, request, "/rematch", "POST"));
    }

    private static UUID matchId(String rawId, HttpServletRequest request, String suffix, String method) {
        // Node matches the raw pathname. Spring has already decoded the path variables.
        if (!(request.getContextPath() + "/api/v1/matches/" + rawId + suffix).equals(request.getRequestURI())) {
            throw MatchService.notFound();
        }
        UUID id;
        try {
            id = RequestInput.uuidValue(rawId);
        } catch (ApiFailure invalid) {
            throw MatchService.notFound();
        }
        if (!method.equals(request.getMethod())) throw new ApiFailure(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED");
        return id;
    }
}
