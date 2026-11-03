package am.polylink.storage;

import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;

@Configuration(proxyBeanMethods = false)
public class StorageConfiguration {
    @Bean(destroyMethod = "close")
    @ConditionalOnProperty(name = "polylink.storage.enabled", havingValue = "true")
    ObjectStorage objectStorage(
            @Value("${polylink.storage.endpoint}") String endpoint,
            @Value("${polylink.storage.region}") String region,
            @Value("${polylink.storage.bucket}") String bucket,
            @Value("${polylink.storage.credentials-file}") String credentials) {
        return new S3ObjectStorage(endpoint, region, bucket, Path.of(credentials));
    }
}
