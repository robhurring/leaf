// Every Rust message must be exactly what the JSON Schema export describes, and
// every schema-valid example must load into the Rust types and come back unchanged.
use jsonschema::Validator;
use leaf_protocol::*;

fn schema(name: &str) -> Validator {
    let text =
        std::fs::read_to_string(format!("../../packages/protocol/schema/{name}.json")).unwrap();
    jsonschema::validator_for(&serde_json::from_str(&text).unwrap()).unwrap()
}
fn fixture(name: &str) -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(format!("tests/fixtures/{name}.json")).unwrap())
        .unwrap()
}

#[test]
fn every_client_fixture_round_trips_and_validates() {
    for name in [
        "hello",
        "list",
        "read",
        "subscribe",
        "unsubscribe",
        "search",
        "searchText",
        "preferences",
        "blame",
    ] {
        let v = fixture(name);
        assert!(
            schema(name).is_valid(&v),
            "fixture {name} must satisfy its own schema"
        );
        let msg: ClientMessage = serde_json::from_value(v.clone()).unwrap();
        let back = serde_json::to_value(&msg).unwrap();
        assert!(
            schema("client").is_valid(&back),
            "{name}: Rust output must satisfy the client union"
        );
        assert_eq!(back, v, "{name}: round trip must be exact");
    }
}

#[test]
fn every_server_fixture_round_trips_and_validates() {
    for name in [
        "welcome",
        "tree",
        "file",
        "changed",
        "matches",
        "textMatches",
        "blameHunks",
        "presence",
        "shareStatus",
        "error",
    ] {
        let v = fixture(name);
        assert!(
            schema(name).is_valid(&v),
            "fixture {name} must satisfy its own schema"
        );
        let msg: ServerMessage = serde_json::from_value(v.clone()).unwrap();
        let back = serde_json::to_value(&msg).unwrap();
        assert!(
            schema("server").is_valid(&back),
            "{name}: Rust output must satisfy the server union"
        );
        assert_eq!(back, v, "{name}: round trip must be exact");
    }
}

#[test]
fn unknown_type_and_bad_shape() {
    assert!(
        matches!(parse_client(r#"{"type":"dance"}"#), Err(ParseError::UnknownType(t)) if t == "dance")
    );
    assert!(matches!(
        parse_client(r#"{"type":"read"}"#),
        Err(ParseError::Invalid(_))
    ));
    assert!(matches!(parse_client("nope"), Err(ParseError::InvalidJson)));
    assert!(is_known_client_type("hello") && !is_known_client_type("dance"));
    assert_eq!(PROTOCOL_VERSION, 1);
}
