use crate::models::PromptBlock;

pub fn compose_prompt(mut blocks: Vec<PromptBlock>) -> Vec<PromptBlock> {
    blocks.sort_by_key(|b| b.order);
    blocks.into_iter().filter(|b| b.enabled).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn respects_block_order() {
        let blocks = vec![
            PromptBlock { id: "2".into(), kind: "history".into(), enabled: true, order: 2, content: "h".into() },
            PromptBlock { id: "1".into(), kind: "system".into(), enabled: true, order: 1, content: "s".into() },
        ];
        let sorted = compose_prompt(blocks);
        assert_eq!(sorted[0].id, "1");
        assert_eq!(sorted[1].id, "2");
    }
}
