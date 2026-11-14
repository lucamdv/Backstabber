package com.backstabber.game.application;

import com.backstabber.game.random.GameRandom;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class MatchConfiguration {
    @Bean
    GameRandom matchRandom() {
        return GameRandom.secure();
    }
}
