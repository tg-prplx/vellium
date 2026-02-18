use crate::models::{ConsistencyIssue, Scene};
use uuid::Uuid;

pub fn run_consistency(project_id: &str, scenes: &[Scene]) -> Vec<ConsistencyIssue> {
    let mut issues = Vec::new();

    for scene in scenes {
        if scene.content.contains("[TODO]") {
            issues.push(ConsistencyIssue {
                id: Uuid::new_v4().to_string(),
                project_id: project_id.to_string(),
                severity: "medium".to_string(),
                category: "facts".to_string(),
                message: format!("Scene '{}' still contains TODO markers", scene.title),
            });
        }

        if scene.content.contains("I ") && scene.content.contains("she ") {
            issues.push(ConsistencyIssue {
                id: Uuid::new_v4().to_string(),
                project_id: project_id.to_string(),
                severity: "low".to_string(),
                category: "pov".to_string(),
                message: format!("Scene '{}' may mix POV styles", scene.title),
            });
        }
    }

    issues
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Scene;

    #[test]
    fn detects_basic_conflicts() {
        let scene = Scene {
            id: "s1".into(),
            chapter_id: "c1".into(),
            title: "Test".into(),
            content: "I walk in. [TODO] she smiles.".into(),
            goals: "".into(),
            conflicts: "".into(),
            outcomes: "".into(),
            created_at: "now".into(),
        };

        let issues = run_consistency("p1", &[scene]);
        assert!(!issues.is_empty());
    }
}
