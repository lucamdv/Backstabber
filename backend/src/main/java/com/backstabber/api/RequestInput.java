package com.backstabber.api;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

public record RequestInput(ObjectNode fields) {
    public static final String ATTRIBUTE = "backstabber.requestInput";
    private static final int LIMIT = 16_384;
    private static final Pattern UUID_FORMAT = Pattern.compile("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}");
    private static final Pattern EDGE_WHITESPACE = Pattern.compile("^[\\t-\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+"
            + "|[\\t-\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+$");

    public static RequestInput read(InputStream body, ObjectMapper json) throws IOException {
        // Node Request.text() uses UTF-8 and measures JavaScript string length (UTF-16 units).
        var reader = new InputStreamReader(body, StandardCharsets.UTF_8);
        var input = new StringBuilder();
        char[] buffer = new char[2048];
        int count;
        while ((count = reader.read(buffer)) != -1) {
            input.append(buffer, 0, count);
            int bom = input.charAt(0) == '\ufeff' ? 1 : 0;
            if (input.length() - bom > LIMIT) {
                throw new ApiFailure(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE");
            }
        }
        if (!input.isEmpty() && input.charAt(0) == '\ufeff') input.deleteCharAt(0);
        if (input.isEmpty()) return new RequestInput(json.createObjectNode());
        try {
            if (json.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(input.toString())
                    instanceof ObjectNode object) return new RequestInput(object);
        } catch (JacksonException invalid) {
            throw ApiFailure.badRequest("INVALID_JSON");
        }
        throw ApiFailure.badRequest("INVALID_JSON");
    }

    public JsonNode node(String field) {
        return fields.path(field);
    }

    public boolean has(String field) {
        return fields.has(field);
    }

    public String text(String field) {
        var value = node(field);
        return value.isTextual() ? value.asString() : "";
    }

    public boolean requiredBoolean(String field) {
        var value = node(field);
        if (!value.isBoolean()) throw ApiFailure.badRequest("INVALID_BOOLEAN");
        return value.asBoolean();
    }

    public UUID uuid(String field) {
        return uuidValue(text(field));
    }

    public static UUID uuidValue(String value) {
        if (value == null || !UUID_FORMAT.matcher(value).matches()) throw ApiFailure.badRequest("INVALID_ID");
        return UUID.fromString(value);
    }

    public static String trim(String value) {
        return EDGE_WHITESPACE.matcher(value).replaceAll("");
    }
}
