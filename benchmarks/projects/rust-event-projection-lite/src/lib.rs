pub fn fold_event(seen: &mut Vec<String>, event_id: &str) {
    seen.push(event_id.to_string());
}

#[cfg(test)]
mod tests {
    use super::fold_event;

    #[test]
    fn ignores_duplicates() {
        let mut seen = vec![];
        fold_event(&mut seen, "evt-1");
        fold_event(&mut seen, "evt-1");
        assert_eq!(seen, vec!["evt-1".to_string()]);
    }
}
