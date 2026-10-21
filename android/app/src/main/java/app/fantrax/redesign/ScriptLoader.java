package app.fantrax.redesign;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Picks the userscript to inject: a newer copy downloaded from the latest GitHub release if one is
 * cached, otherwise the copy bundled in the APK. A fresh copy is fetched in the background on every
 * launch and takes effect on the next one, so startup never waits on the network.
 */
final class ScriptLoader {
    static final String REMOTE_URL =
        "https://github.com/dorzazon8/fantrax-redesign/releases/latest/download/fantrax-redesign.user.js";
    private static final String BUNDLED = "fantrax.user.js";
    private static final String CACHED = "remote.user.js";
    private static final int MAX_BYTES = 2_000_000;

    private ScriptLoader() {}

    static String load(Context ctx) {
        String bundled = readBundled(ctx);
        File cache = new File(ctx.getFilesDir(), CACHED);
        if (cache.isFile()) {
            try {
                String cached = new String(java.nio.file.Files.readAllBytes(cache.toPath()), StandardCharsets.UTF_8);
                if (isValid(cached) && Net.isNewer(Net.scriptVersion(cached), Net.scriptVersion(bundled))) {
                    return cached;
                }
            } catch (Exception ignored) {
            }
        }
        return bundled;
    }

    static void refreshAsync(Context ctx) {
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            try {
                String fresh = new String(Net.get(REMOTE_URL, MAX_BYTES), StandardCharsets.UTF_8);
                if (!isValid(fresh)) return;
                File tmp = new File(app.getFilesDir(), CACHED + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    out.write(fresh.getBytes(StandardCharsets.UTF_8));
                }
                File dest = new File(app.getFilesDir(), CACHED);
                if (!tmp.renameTo(dest)) tmp.delete();
            } catch (Exception ignored) {
                // Offline or no release yet: keep whatever script we already have.
            }
        }, "script-refresh").start();
    }

    private static boolean isValid(String s) {
        return s.startsWith("// ==UserScript==") && s.contains("// @version");
    }

    private static String readBundled(Context ctx) {
        try (InputStream in = ctx.getAssets().open(BUNDLED)) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            throw new IllegalStateException("Missing asset " + BUNDLED, e);
        }
    }
}
