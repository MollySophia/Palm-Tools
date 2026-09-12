import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kode_mobile/src/api/api_client.dart';
import 'package:kode_mobile/src/protocol/protocol.dart';
import 'package:kode_mobile/src/state/providers.dart';

Endpoint makeEndpoint(String id) => Endpoint(
  serverUrl: 'https://sync.example.com',
  token: 'test-$id',
  deviceId: id,
  deviceName: id,
);

class DeviceApi extends ApiClient {
  DeviceApi(super.endpoint);
  Completer<List<SessionDto>>? pending;

  @override
  Future<List<SessionDto>> listSessions() async =>
      pending == null ? [session(endpoint.deviceId)] : await pending!.future;
}

// Intentionally identical IDs: IDs can collide when switching sync servers.
SessionDto session(String title) => SessionDto(
  id: 1,
  backendKey: 'codex',
  model: 'test-model',
  title: title,
  status: 'idle',
  tokens: TokensDto(),
);

void main() {
  for (final fails in [false, true]) {
    test(
      'old device refresh ${fails ? 'failure' : 'success'} cannot replace new device',
      () async {
        final first = DeviceApi(makeEndpoint('first'));
        final second = DeviceApi(makeEndpoint('second'));
        final container = ProviderContainer(
          overrides: [
            endpointProvider.overrideWith((ref) => first.endpoint),
            apiClientProvider.overrideWith(
              (ref) => ref.watch(endpointProvider)?.deviceId == 'first'
                  ? first
                  : second,
            ),
            eventStreamProvider.overrideWith((ref) => const Stream.empty()),
          ],
        );
        addTearDown(container.dispose);
        final subscription = container.listen(sessionsProvider, (_, _) {});
        addTearDown(subscription.close);
        await container.read(sessionsProvider.future);
        first.pending = Completer<List<SessionDto>>();
        final oldRefresh = container.read(sessionsProvider.notifier).refresh();
        container.read(endpointProvider.notifier).state = second.endpoint;
        await container.read(sessionsProvider.future);
        expect(
          container.read(sessionsProvider).requireValue.single.title,
          'second',
        );
        if (fails) {
          first.pending!.completeError(Exception('old device disconnected'));
        } else {
          first.pending!.complete([session('stale first')]);
        }
        await oldRefresh;
        expect(
          container.read(sessionsProvider).requireValue.single.title,
          'second',
        );
      },
    );
  }
}
