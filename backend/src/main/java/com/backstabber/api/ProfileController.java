package com.backstabber.api;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.backstabber.social.Profile;
import com.backstabber.social.ProfileReader;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.node.NullNode;

@RestController
public class ProfileController {
    private final ProfileReader profiles;

    public ProfileController(ProfileReader profiles) {
        this.profiles = profiles;
    }

    @GetMapping("/api/v1/profile")
    public ResponseEntity<Object> profile(@AuthenticationPrincipal UUID userId) {
        Object body = profiles.findOwnProfile(userId).<Object>map(profile -> profile).orElse(NullNode.getInstance());
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(body);
    }

    @PutMapping("/api/v1/profile")
    public Profile update(@AuthenticationPrincipal UUID userId,
            @RequestAttribute(RequestInput.ATTRIBUTE) RequestInput input) {
        return profiles.update(userId, input);
    }

    @PostMapping("/api/v1/profile/heartbeat")
    public Map<String, Boolean> heartbeat(@AuthenticationPrincipal UUID userId) {
        profiles.heartbeat(userId);
        return Map.of("ok", true);
    }

    @GetMapping("/api/v1/users")
    public List<Profile> search(@AuthenticationPrincipal UUID userId,
            HttpServletRequest request) {
        String username = request.getParameter("username");
        return profiles.search(userId, username == null ? "" : username);
    }
}
