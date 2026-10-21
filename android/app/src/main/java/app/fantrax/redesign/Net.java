package app.fantrax.redesign;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Small HTTPS and version helpers shared by the script loader and the updater. */
final class Net {
    private static final Pattern SCRIPT_VERSION = Pattern.compile("//\\s*@version\\s+(\\S+)");

    private Net() {}

    static byte[] get(String url, int maxBytes) throws IOException {
        if (!url.startsWith("https://")) throw new IOException("HTTPS required");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(20000);
        c.setRequestProperty("User-Agent", "FantraxRedesignApp");
        try {
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > maxBytes) throw new IOException("Response too large");
                }
                return out.toByteArray();
            }
        } finally {
            c.disconnect();
        }
    }

    /** True when {@code candidate} is a higher dotted version than {@code current} (a leading "v" is ignored). */
    static boolean isNewer(String candidate, String current) {
        int[] a = parse(candidate);
        int[] b = parse(current);
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            int x = i < a.length ? a[i] : 0;
            int y = i < b.length ? b[i] : 0;
            if (x != y) return x > y;
        }
        return false;
    }

    static String scriptVersion(String userscript) {
        Matcher m = SCRIPT_VERSION.matcher(userscript);
        return m.find() ? m.group(1) : "0";
    }

    private static int[] parse(String v) {
        String[] parts = v.replaceFirst("^[vV]", "").split("\\.");
        int[] out = new int[parts.length];
        for (int i = 0; i < parts.length; i++) {
            String digits = parts[i].replaceAll("\\D.*$", "");
            out[i] = digits.isEmpty() ? 0 : Integer.parseInt(digits);
        }
        return out;
    }
}
