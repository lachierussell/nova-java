package com.example;

/** A source of greetings. Implemented by {@link FriendlyGreeter}. */
public interface Greeter {

    /** Return a greeting for the given name. */
    String greet(String name);
}
