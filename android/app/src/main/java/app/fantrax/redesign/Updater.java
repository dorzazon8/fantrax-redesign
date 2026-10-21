package app.fantrax.redesign;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Checks GitHub Releases for a newer APK and offers to install it. Android always asks the user to
 * confirm the install, and only accepts an APK signed with the same key as the installed app.
 */
final class Updater {
    private static final String RELEASES_API =
        "https://api.github.com/repos/dorzazon8/fantrax-redesign/releases/latest";
    private static final String ASSET_PREFIX =
        "https://github.com/dorzazon8/fantrax-redesign/releases/download/";
    private static final int MAX_APK_BYTES = 60_000_000;

    private Updater() {}

    static void checkAsync(Activity activity) {
        new Thread(() -> {
            try {
                JSONObject release = new JSONObject(
                    new String(Net.get(RELEASES_API, 1_000_000), StandardCharsets.UTF_8));
                String tag = release.getString("tag_name");
                if (!Net.isNewer(tag, BuildConfig.VERSION_NAME)) return;
                String apkUrl = findApk(release.getJSONArray("assets"));
                if (apkUrl == null) return;
                String notes = release.optString("body", "").trim();
                activity.runOnUiThread(() -> {
                    if (!activity.isFinishing() && !activity.isDestroyed()) {
                        prompt(activity, tag, notes, apkUrl);
                    }
                });
            } catch (Exception ignored) {
                // Offline, rate limited or no release yet: try again next launch.
            }
        }, "update-check").start();
    }

    private static String findApk(JSONArray assets) throws Exception {
        for (int i = 0; i < assets.length(); i++) {
            JSONObject a = assets.getJSONObject(i);
            String url = a.getString("browser_download_url");
            if (a.getString("name").endsWith(".apk") && url.startsWith(ASSET_PREFIX)) return url;
        }
        return null;
    }

    private static void prompt(Activity activity, String tag, String notes, String apkUrl) {
        String msg = "Version " + tag.replaceFirst("^[vV]", "") + " is available.";
        if (!notes.isEmpty()) msg += "\n\n" + (notes.length() > 400 ? notes.substring(0, 400) + "…" : notes);
        new AlertDialog.Builder(activity)
            .setTitle("Update available")
            .setMessage(msg)
            .setNegativeButton("Later", null)
            .setPositiveButton("Update", (d, w) -> startUpdate(activity, apkUrl))
            .show();
    }

    private static void startUpdate(Activity activity, String apkUrl) {
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(activity,
                "Allow installs from this app, then reopen it to update.", Toast.LENGTH_LONG).show();
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + activity.getPackageName())));
            return;
        }
        AlertDialog progress = new AlertDialog.Builder(activity)
            .setMessage("Downloading update…")
            .setCancelable(false)
            .show();
        new Thread(() -> {
            try {
                byte[] apk = Net.get(apkUrl, MAX_APK_BYTES);
                File dir = new File(activity.getCacheDir(), "updates");
                dir.mkdirs();
                File file = new File(dir, "update.apk");
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(apk);
                }
                activity.runOnUiThread(() -> {
                    progress.dismiss();
                    install(activity, file);
                });
            } catch (Exception e) {
                activity.runOnUiThread(() -> {
                    progress.dismiss();
                    Toast.makeText(activity, "Update download failed", Toast.LENGTH_LONG).show();
                });
            }
        }, "update-download").start();
    }

    private static void install(Activity activity, File apk) {
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".updates", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(intent);
    }
}
