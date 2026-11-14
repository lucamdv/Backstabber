package com.backstabber.security;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import com.backstabber.api.ApiErrorHandler.ErrorBody;
import com.backstabber.api.ApiFailure;
import com.backstabber.api.RequestInput;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

@Configuration
public class ApiSecurity {
    private static final Pattern MATCH_ROUTE = Pattern.compile("/api/v1/matches/[^/]+(?:/(?:commands|rematch))?");
    private static final Pattern BEARER = Pattern.compile("Bearer ([\\w.-]+)");
    private static final Set<String> BODY_METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, SupabaseAuthenticator authenticator,
            ObjectMapper json, @Value("${backstabber.allowed-origin:}") String origins) {
        Set<String> allowed = Arrays.stream(origins.split(",")).map(String::trim)
                .filter(origin -> !origin.isEmpty()).collect(Collectors.toUnmodifiableSet());
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/actuator/health", "/actuator/health/liveness", "/actuator/health/readiness").permitAll()
                        .requestMatchers("/api/v1/**").authenticated()
                        .anyRequest().denyAll())
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, failure) ->
                                writeError(response, json, 401, "UNAUTHENTICATED"))
                        .accessDeniedHandler((request, response, failure) ->
                                writeError(response, json, 403, "NOT_AUTHORIZED")))
                .addFilterBefore(new OncePerRequestFilter() {
                    @Override
                    protected boolean shouldNotFilter(HttpServletRequest request) {
                        return !request.getServletPath().startsWith("/api/v1/");
                    }

                    @Override
                    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                            FilterChain chain) throws IOException, ServletException {
                        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
                        response.addHeader(HttpHeaders.VARY, HttpHeaders.ORIGIN);
                        String origin = request.getHeader(HttpHeaders.ORIGIN);
                        if (origin != null && allowed.contains(origin)) {
                            response.setHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, origin);
                        }
                        if ("OPTIONS".equals(request.getMethod())) {
                            response.setHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS, "GET, POST, PUT, DELETE, OPTIONS");
                            response.setHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS, "Authorization, Content-Type");
                            response.setStatus(HttpServletResponse.SC_NO_CONTENT);
                            return;
                        }
                        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
                        var match = BEARER.matcher(authorization == null ? "" : authorization);
                        UUID userId;
                        try {
                            if (!match.matches()) throw ApiFailure.unauthenticated();
                            userId = authenticator.authenticate(match.group(1));
                            if (BODY_METHODS.contains(request.getMethod())) {
                                request.setAttribute(RequestInput.ATTRIBUTE, RequestInput.read(request.getInputStream(), json));
                            }
                        } catch (ApiFailure failure) {
                            writeError(response, json, failure.status().value(), failure.getMessage());
                            return;
                        }
                        if ("HEAD".equals(request.getMethod()) && !MATCH_ROUTE.matcher(request.getServletPath()).matches()) {
                            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
                            return;
                        }
                        var context = SecurityContextHolder.createEmptyContext();
                        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(userId, null, List.of()));
                        SecurityContextHolder.setContext(context);
                        try {
                            chain.doFilter(request, response);
                        } finally {
                            SecurityContextHolder.clearContext();
                        }
                    }
                }, AnonymousAuthenticationFilter.class)
                .build();
    }

    private static void writeError(HttpServletResponse response, ObjectMapper json, int status, String code)
            throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        json.writeValue(response.getOutputStream(), new ErrorBody(code));
    }
}
