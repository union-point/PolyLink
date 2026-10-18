import java.util.Arrays;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;

/** Public fixture timing only; prints no input, hash, key or verifier. */
public class ServerHashBenchmark {
    public static void main(String[] args) {
        var encoder=new Argon2PasswordEncoder(16,32,1,65536,3);
        long[] encode=new long[3],verify=new long[3];
        for(int i=0;i<3;i++){
            long start=System.nanoTime();String hash=encoder.encode("A".repeat(43));encode[i]=(System.nanoTime()-start)/1_000_000;
            start=System.nanoTime();if(!encoder.matches("A".repeat(43),hash))throw new AssertionError("Fixture verification failed");verify[i]=(System.nanoTime()-start)/1_000_000;
        }
        System.out.println("{\"algorithm\":\"server Argon2id\",\"memoryKiB\":65536,\"iterations\":3,\"parallelism\":1,\"encodeMilliseconds\":"+Arrays.toString(encode)+",\"verifyMilliseconds\":"+Arrays.toString(verify)+"}");
    }
}
