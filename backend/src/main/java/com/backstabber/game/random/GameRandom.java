package com.backstabber.game.random;

import java.security.SecureRandom;

@FunctionalInterface
public interface GameRandom {
    double nextDouble();

    static GameRandom secure() {
        var source = new SecureRandom();
        // Same 32-bit sample space as the authoritative Node match store.
        return () -> Integer.toUnsignedLong(source.nextInt()) / 0x1_0000_0000p0;
    }
}
