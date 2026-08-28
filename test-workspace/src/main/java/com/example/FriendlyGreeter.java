package com.example;

/**
 * A {@link Greeter} that adds a friendly flourish.
 *
 * Try it out:
 * • Put the cursor on {@code Greeter} and run "Jump To Definition".
 * • Put the cursor on {@code greet} and run "Find References".
 * • Put the cursor on {@code Greeter} and run "Jump To Implementation".
 */
public class FriendlyGreeter implements Greeter {

    private final String flourish;

    public FriendlyGreeter(String flourish) {
        this.flourish = flourish;
    }

    @Override
    public String greet(String name) {
        return "Hello, " + name + "! " + flourish;
    }
}
