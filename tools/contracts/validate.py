"""Validate the OpenAPI document and positive/negative DTO fixtures; no live service required."""
import json
from pathlib import Path
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate

root = Path(__file__).resolve().parents[2]
contract = yaml.safe_load((root / 'docs/messenger/contracts/openapi.yaml').read_text())
validate(contract)
validator = Draft202012Validator(contract, format_checker=FormatChecker())
for fixture in json.loads((root / 'docs/messenger/fixtures/contracts.json').read_text()):
    schema = {'$ref': '#/components/schemas/' + fixture['schema'], 'components': contract['components']}
    errors = list(validator.evolve(schema=schema).iter_errors(fixture['value']))
    if bool(errors) == fixture['valid']:
        raise AssertionError(f"{fixture['name']}: expected valid={fixture['valid']}; {errors}")
operations = []
for path, item in contract['paths'].items():
    for method, operation in item.items():
        if method not in {'get','post','put','delete','patch'}:
            continue
        operations.append(operation['operationId'])
        if method == 'get':
            assert 'requestBody' not in operation, path
        assert operation['responses'], path
assert len(operations) == len(set(operations)), 'Duplicate operationId'
for name, schema in contract['components']['schemas'].items():
    if schema.get('type') == 'object':
        assert schema.get('additionalProperties') is False, name
        assert set(schema['required']) <= set(schema['properties']), name
        assert not {'password','newPassword','oldPassword'} & schema['properties'].keys(), name
states = json.loads((root / 'docs/messenger/fixtures/transitions.json').read_text())['recovery']
for source, targets in states.items():
    assert set(targets) <= states.keys(), source
for terminal in ('COMPLETED','CANCELLED','EXPIRED'):
    assert states[terminal] == [], terminal
print(f'OpenAPI valid; {len(operations)} operations and all DTO/state fixtures verified.')
# Plaintext structures have a separate schema and must never be sent as HTTP DTOs.
client = json.loads((root / 'docs/messenger/contracts/client-payloads.schema.json').read_text())
Draft202012Validator.check_schema(client)
plain = json.loads((root / 'docs/messenger/fixtures/crypto-vectors.json').read_text())['message']['plaintext']
message_schema = {**client, '$ref': '#/$defs/MessagePlaintext'}
Draft202012Validator(message_schema, format_checker=FormatChecker()).validate(json.loads(plain))
assert not Draft202012Validator(message_schema).is_valid({'text':'','attachment':None})
assert not Draft202012Validator(message_schema).is_valid({'text':'hello','attachment':None,'html':'<b>bad</b>'})
print('Separate client-only plaintext schemas and fixed message payload verified.')
