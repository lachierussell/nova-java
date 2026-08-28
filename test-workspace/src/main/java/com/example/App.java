package com.example;

import java.util.List;

/** Entry point that wires a few greeters together. */
public class App {

    public static void main(String[] args) {
        Greeter greeter = new FriendlyGreeter("Welcome to Nova.");

        List<String> names = List.of("Ada", "Alan", "Grace");
        for (String name : names) {
            System.out.println(greeter.greet(name));
        }
    }
}
