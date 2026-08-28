package com.example;

// This unused import is here on purpose:
//   run "Organize Imports" and it should disappear.
import java.util.Map;

/**
 * A scratch file with intentional issues so you can try the extension's
 * diagnostics and code actions.
 *
 * Things to try:
 *   • The {@code ArrayList} below is unresolved — you should see an error in the
 *     Issues panel. Put the cursor on it and run "Code Actions…" (⌥⏎), then pick
 *     "Import 'ArrayList' (java.util)". The error should clear.
 *   • Run "Organize Imports" to drop the unused {@code java.util.Map} import.
 *   • Add a method to {@link Greeter} and watch {@link FriendlyGreeter} report a
 *     new error, then use "Code Actions…" to add the unimplemented method.
 */
public class Playground {

    public static void main(String[] args) {
        // `ArrayList` is intentionally not imported — fix it with a code action.
        var names = new ArrayList<String>();
        names.add("Nova");
        System.out.println(names);
    }
}
