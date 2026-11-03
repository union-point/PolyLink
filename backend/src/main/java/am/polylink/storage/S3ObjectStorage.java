package am.polylink.storage;

import am.polylink.auth.AuthFailure;
import java.io.*;
import java.net.URI;
import java.nio.file.*;
import java.time.Duration;
import java.util.Properties;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.*;
import software.amazon.awssdk.services.s3.model.*;

public final class S3ObjectStorage implements ObjectStorage {
    private final S3Client client;
    private final String bucket;

    public S3ObjectStorage(String endpoint, String region, String bucket, Path credentials) {
        URI uri = URI.create(endpoint);
        if (!"https".equals(uri.getScheme())
                || uri.getUserInfo() != null
                || uri.getHost() == null
                || uri.getQuery() != null
                || uri.getFragment() != null)
            throw new IllegalArgumentException("S3_ENDPOINT must be an HTTPS endpoint");
        try (var input = Files.newInputStream(credentials)) {
            var values = new Properties();
            values.load(input);
            String access = values.getProperty("accessKey"),
                    secret = values.getProperty("secretKey");
            if (access == null || access.isBlank() || secret == null || secret.isBlank())
                throw new IllegalArgumentException("Storage credentials are required");
            client =
                    S3Client.builder()
                            .endpointOverride(uri)
                            .region(Region.of(region))
                            .credentialsProvider(
                                    StaticCredentialsProvider.create(
                                            AwsBasicCredentials.create(access, secret)))
                            .httpClientBuilder(
                                    software.amazon.awssdk.http.apache.ApacheHttpClient.builder()
                                            .maxConnections(32)
                                            .connectionTimeout(Duration.ofSeconds(5))
                                            .connectionAcquisitionTimeout(Duration.ofSeconds(5))
                                            .socketTimeout(Duration.ofSeconds(30)))
                            .serviceConfiguration(
                                    S3Configuration.builder().pathStyleAccessEnabled(true).build())
                            .overrideConfiguration(
                                    c ->
                                            c.apiCallTimeout(Duration.ofSeconds(60))
                                                    .apiCallAttemptTimeout(Duration.ofSeconds(20))
                                                    .retryStrategy(
                                                            software.amazon.awssdk.retries
                                                                    .StandardRetryStrategy.builder()
                                                                    .maxAttempts(3)
                                                                    .build()))
                            .build();
        } catch (IOException e) {
            throw new IllegalArgumentException("Cannot read storage credentials");
        }
        if (!bucket.matches("[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]"))
            throw new IllegalArgumentException("Invalid storage bucket");
        this.bucket = bucket;
    }

    @Override
    public void put(String key, Path file, String type) {
        try {
            client.putObject(
                    r -> r.bucket(bucket).key(key).contentType(type), RequestBody.fromFile(file));
        } catch (RuntimeException e) {
            io.micrometer.core.instrument.Metrics.counter(
                            "polylink.storage.failures", "operation", "put")
                    .increment();
            throw AuthFailure.unavailable();
        }
    }

    @Override
    public Download get(String key) {
        try {
            var response = client.getObject(r -> r.bucket(bucket).key(key));
            return new Download(response, response.response().contentLength());
        } catch (RuntimeException e) {
            io.micrometer.core.instrument.Metrics.counter(
                            "polylink.storage.failures", "operation", "get")
                    .increment();
            throw AuthFailure.unavailable();
        }
    }

    @Override
    public long size(String key) {
        try {
            return client.headObject(r -> r.bucket(bucket).key(key)).contentLength();
        } catch (RuntimeException e) {
            io.micrometer.core.instrument.Metrics.counter(
                            "polylink.storage.failures", "operation", "size")
                    .increment();
            throw AuthFailure.unavailable();
        }
    }

    @Override
    public void delete(String key) {
        try {
            client.deleteObject(r -> r.bucket(bucket).key(key));
        } catch (RuntimeException e) {
            io.micrometer.core.instrument.Metrics.counter(
                            "polylink.storage.failures", "operation", "delete")
                    .increment();
            throw AuthFailure.unavailable();
        }
    }

    @Override
    public Page list(String prefix, String cursor) {
        try {
            var result =
                    client.listObjectsV2(
                            r ->
                                    r.bucket(bucket)
                                            .prefix(prefix)
                                            .continuationToken(cursor)
                                            .maxKeys(100));
            return new Page(
                    result.contents().stream()
                            .map(o -> new Entry(o.key(), o.lastModified()))
                            .toList(),
                    result.nextContinuationToken());
        } catch (RuntimeException e) {
            io.micrometer.core.instrument.Metrics.counter(
                            "polylink.storage.failures", "operation", "list")
                    .increment();
            throw AuthFailure.unavailable();
        }
    }

    public void createBucket() {
        try {
            client.headBucket(r -> r.bucket(bucket));
        } catch (S3Exception e) {
            if (e.statusCode() != 404) throw am.polylink.auth.AuthFailure.unavailable();
            client.createBucket(r -> r.bucket(bucket));
        }
    }

    @Override
    public void close() {
        client.close();
    }
}
