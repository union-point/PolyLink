package am.polylink.storage;

import am.polylink.auth.*;
import java.io.*;
import java.nio.file.*;
import java.time.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.*;
import org.springframework.stereotype.Service;

@Service
@IdentityEnabled
public class StorageService {
    private final ObjectProvider<ObjectStorage> objects;
    private final Path temporary;

    public StorageService(
            ObjectProvider<ObjectStorage> objects,
            @Value("${polylink.storage.temp-dir}") String temporary) {
        this.objects = objects;
        this.temporary = Path.of(temporary);
        try {
            // Never remove another live process's input; the local runner uses one backend.
            if (Files.isDirectory(this.temporary))
                try (var files = Files.list(this.temporary)) {
                    for (var file :
                            files.filter(
                                            p ->
                                                    p.getFileName()
                                                            .toString()
                                                            .matches("upload-.*\\.ciphertext"))
                                    .toList())
                        if (Files.getLastModifiedTime(file)
                                .toInstant()
                                .isBefore(Instant.now().minus(Duration.ofDays(1))))
                            Files.deleteIfExists(file);
                }
        } catch (IOException e) {
            throw new IllegalStateException("Cannot prepare ciphertext spool");
        }
    }

    public boolean enabled() {
        return objects.getIfAvailable() != null;
    }

    public ObjectStorage objects() {
        var value = objects.getIfAvailable();
        if (value == null) throw AuthFailure.unavailable();
        return value;
    }

    public Spool spool(InputStream source, long min, long max) {
        return Spool.read(temporary, source, min, max);
    }

    public void put(String key, Spool spool, String type) {
        objects().put(key, spool.path(), type);
        Spool.verify(objects(), key, spool.size(), spool.digest());
    }

    public ObjectStorage.Download get(String key, long size) {
        var object = objects().get(key);
        if (object.size() != size) {
            try {
                object.close();
            } catch (IOException ignored) {
            }
            throw AuthFailure.unavailable();
        }
        return object;
    }

    public static ResponseEntity<InputStreamResource> response(
            ObjectStorage.Download object, String type, boolean attachment) {
        var response =
                ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(type))
                        .contentLength(object.size())
                        .header("Cache-Control", "no-store")
                        .header("X-Content-Type-Options", "nosniff");
        if (attachment) response.header("Content-Disposition", "attachment");
        return response.body(new InputStreamResource(object.stream()));
    }
}
