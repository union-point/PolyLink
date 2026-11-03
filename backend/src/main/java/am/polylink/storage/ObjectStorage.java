package am.polylink.storage;

import java.io.*;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

/** Private object bytes only. Application permissions always come from SQL. */
public interface ObjectStorage extends AutoCloseable {
    record Download(InputStream stream, long size) implements AutoCloseable {
        @Override
        public void close() throws IOException {
            stream.close();
        }
    }

    record Entry(String key, Instant modified) {}

    record Page(List<Entry> entries, String next) {}

    void put(String key, Path file, String contentType);

    Download get(String key);

    long size(String key);

    void delete(String key);

    Page list(String prefix, String cursor);

    @Override
    default void close() {}
}
