package am.polylink.storage;

import am.polylink.auth.AuthFailure;
import java.io.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.*;

/** Bounded, replayable ciphertext input. Never contains messenger plaintext. */
public record Spool(Path path, long size, byte[] digest) implements AutoCloseable {
    public static Spool read(Path directory, InputStream source, long min, long max) {
        Path file = null;
        try {
            Files.createDirectories(directory);
            if (Files.isSymbolicLink(directory))
                throw new IOException("Symlink temporary directory");
            Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
            file =
                    Files.createTempFile(
                            directory,
                            "upload-",
                            ".ciphertext",
                            PosixFilePermissions.asFileAttribute(
                                    PosixFilePermissions.fromString("rw-------")));
            var digest = MessageDigest.getInstance("SHA-256");
            long size = 0;
            try (var out = Files.newOutputStream(file)) {
                byte[] buffer = new byte[65536];
                int n;
                while ((n = source.read(buffer)) != -1) {
                    size += n;
                    if (size > max) throw AuthFailure.invalid();
                    digest.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                }
            }
            if (size < min) throw AuthFailure.invalid();
            return new Spool(file, size, digest.digest());
        } catch (IOException | NoSuchAlgorithmException | RuntimeException e) {
            if (file != null)
                try {
                    Files.deleteIfExists(file);
                } catch (IOException ignored) {
                }
            if (e instanceof AuthFailure failure) throw failure;
            throw AuthFailure.unavailable();
        }
    }

    public static void verify(ObjectStorage storage, String key, long size, byte[] expected) {
        try (var object = storage.get(key)) {
            if (object.size() != size) throw AuthFailure.unavailable();
            var digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[65536];
            int n;
            long count = 0;
            while ((n = object.stream().read(buffer)) != -1) {
                count += n;
                if (count > size) throw AuthFailure.unavailable();
                digest.update(buffer, 0, n);
            }
            if (count != size || !MessageDigest.isEqual(expected, digest.digest()))
                throw AuthFailure.unavailable();
        } catch (IOException | NoSuchAlgorithmException e) {
            throw AuthFailure.unavailable();
        }
    }

    @Override
    public void close() {
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
        }
    }
}
