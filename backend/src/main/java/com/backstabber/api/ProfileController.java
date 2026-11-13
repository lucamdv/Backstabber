package com.backstabber.api;

import java.util.UUID;

import com.backstabber.social.ProfileReader;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
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
}
